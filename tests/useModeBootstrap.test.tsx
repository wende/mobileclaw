import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { useModeBootstrap } from "@/hooks/chat/useModeBootstrap";
import type { BackendMode, Message } from "@/types/chat";
import type { LmStudioConfig } from "@/lib/lmStudio";
import type { Command } from "@/components/CommandSheet";
import type { BridgeMessage } from "@/lib/nativeBridge";

function mockLocalStorage() {
  const store = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    get length() {
      return store.size;
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}

function stateSetter<T>() {
  return vi.fn() as unknown as Dispatch<SetStateAction<T>>;
}

function createOptions(overrides: Partial<Parameters<typeof useModeBootstrap>[0]> = {}) {
  return {
    isDemoMode: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    handleNativeBridgeMessage: vi.fn() as (msg: BridgeMessage) => void,
    resetThinkingState: vi.fn(),
    gatewayTokenRef: { current: null } as MutableRefObject<string | null>,
    lmStudioConfigRef: { current: null } as MutableRefObject<LmStudioConfig | null>,
    lmStudioHandlerRef: { current: null } as MutableRefObject<{ stop: () => void } | null>,
    setOpenclawUrl: stateSetter<string | null>(),
    setMessages: stateSetter<Message[]>(),
    setConnectionError: stateSetter<string | null>(),
    setCurrentModel: stateSetter<string | null>(),
    setBackendMode: stateSetter<BackendMode>(),
    setIsDemoMode: stateSetter<boolean>(),
    setShowSetup: stateSetter<boolean>(),
    setHistoryLoaded: stateSetter<boolean>(),
    setIsInitialConnecting: stateSetter<boolean>(),
    setServerCommands: stateSetter<Command[]>(),
    isDetachedRef: { current: false } as MutableRefObject<boolean>,
    isNativeRef: { current: false } as MutableRefObject<boolean>,
    ...overrides,
  };
}

describe("useModeBootstrap", () => {
  beforeEach(() => {
    mockLocalStorage();
    window.history.replaceState({}, "", "/?demo");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("removes ?demo when switching to OpenClaw mode", () => {
    const options = createOptions();
    const { result } = renderHook(() => useModeBootstrap(options));

    act(() => {
      result.current.handleConnect({
        mode: "openclaw",
        url: "https://gateway.example.com",
        token: "secret",
        remember: false,
      });
    });

    expect(window.location.search).toBe("");
    expect(options.connect).toHaveBeenCalledWith("wss://gateway.example.com");
    expect(options.setIsDemoMode).toHaveBeenCalledWith(false);
    expect(options.setBackendMode).toHaveBeenCalledWith("openclaw");
  });
});
