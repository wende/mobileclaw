import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

import { SetupDialog } from "@mc/components/SetupDialog";

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

describe("SetupDialog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockLocalStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("submits OpenClaw connection when Connect is clicked", async () => {
    const onConnect = vi.fn();

    render(
      <SetupDialog
        onConnect={onConnect}
        visible
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledWith({
      mode: "openclaw",
      url: "ws://127.0.0.1:18789",
      token: undefined,
      remember: false,
    });
  });
});
