import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildGatewayAuthCacheEntry,
  deleteGatewayAuthCacheEntry,
  getGatewayAuthCacheEntry,
  hashAuthToken,
  normalizeGatewayUrl,
  resetGatewayAuthCacheForTests,
  setGatewayAuthCacheEntry,
  shouldPersistGatewayAuthHandoffTokens,
} from "@mc/lib/gatewayAuth";

describe("gatewayAuth", () => {
  const createStorage = () => {
    const store = new Map<string, string>();
    return {
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
    };
  };

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: createStorage(),
      configurable: true,
    });
    window.localStorage.clear();
    resetGatewayAuthCacheForTests();
  });

  afterEach(() => {
    window.localStorage.clear();
    resetGatewayAuthCacheForTests();
  });

  it("normalizes gateway URLs before storing and reading entries", async () => {
    const authTokenSha256 = await hashAuthToken("secret");
    await setGatewayAuthCacheEntry("ws://localhost:18789/?foo=1#hash", {
      deviceToken: "devtok-1",
      role: "operator",
      scopes: ["operator.read"],
      authTokenSha256,
      updatedAtMs: 1,
    });

    expect(normalizeGatewayUrl("ws://localhost:18789/?foo=1#hash")).toBe("ws://localhost:18789/");
    expect(await getGatewayAuthCacheEntry("ws://localhost:18789")).toMatchObject({
      deviceToken: "devtok-1",
      authTokenSha256,
    });
  });

  it("stores entries per gateway URL", async () => {
    await setGatewayAuthCacheEntry("ws://localhost:18789", {
      deviceToken: "alpha",
      role: "operator",
      scopes: ["operator.read"],
      authTokenSha256: await hashAuthToken("alpha-token"),
      updatedAtMs: 1,
    });
    await setGatewayAuthCacheEntry("wss://remote.example.com", {
      deviceToken: "beta",
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      authTokenSha256: await hashAuthToken("beta-token"),
      updatedAtMs: 2,
    });

    expect((await getGatewayAuthCacheEntry("ws://localhost:18789"))?.deviceToken).toBe("alpha");
    expect((await getGatewayAuthCacheEntry("wss://remote.example.com"))?.deviceToken).toBe("beta");
  });

  it("keeps handoff tokens only for secure or loopback transports", async () => {
    const auth = {
      deviceToken: "primary",
      role: "operator",
      scopes: ["operator.read"],
      deviceTokens: [
        { deviceToken: "handoff", role: "operator", scopes: ["operator.read"], issuedAtMs: 1 },
      ],
    };

    expect(shouldPersistGatewayAuthHandoffTokens("wss://remote.example.com")).toBe(true);
    expect(shouldPersistGatewayAuthHandoffTokens("ws://localhost:18789")).toBe(true);
    expect(shouldPersistGatewayAuthHandoffTokens("ws://remote.example.com")).toBe(false);

    expect(buildGatewayAuthCacheEntry("wss://remote.example.com", auth, "hash").deviceTokens).toHaveLength(1);
    expect(buildGatewayAuthCacheEntry("ws://localhost:18789", auth, "hash").deviceTokens).toHaveLength(1);
    expect(buildGatewayAuthCacheEntry("ws://remote.example.com", auth, "hash").deviceTokens).toBeUndefined();
  });

  it("hashes auth tokens consistently for cache matching", async () => {
    const first = await hashAuthToken("shared-secret");
    const second = await hashAuthToken("shared-secret");
    const third = await hashAuthToken("different-secret");

    expect(first).toBe(second);
    expect(first).not.toBe(third);
  });

  it("deletes stale cached entries", async () => {
    await setGatewayAuthCacheEntry("ws://localhost:18789", {
      deviceToken: "devtok-1",
      role: "operator",
      scopes: ["operator.read"],
      authTokenSha256: await hashAuthToken("secret"),
      updatedAtMs: 1,
    });

    expect(await getGatewayAuthCacheEntry("ws://localhost:18789")).not.toBeNull();
    await deleteGatewayAuthCacheEntry("ws://localhost:18789");
    expect(await getGatewayAuthCacheEntry("ws://localhost:18789")).toBeNull();
  });
});
