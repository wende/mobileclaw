import { isNativeMode, postNativeGatewayAuthDelete, postNativeGatewayAuthSet, requestNativeGatewayAuthGet } from "@mc/lib/nativeBridge";
import type { HelloOkAuth, HelloOkAuthToken } from "@mc/types/chat";

export const GATEWAY_AUTH_STORAGE_KEY = "mc-openclaw-device-auth-v1";

export type GatewayAuthToken = HelloOkAuthToken;

export type GatewayAuthCacheEntry = {
  deviceToken: string;
  role: string;
  scopes: string[];
  issuedAtMs?: number;
  deviceTokens?: GatewayAuthToken[];
  authTokenSha256: string;
  updatedAtMs: number;
};

type GatewayAuthCacheMap = Record<string, GatewayAuthCacheEntry>;

let cachedMap: GatewayAuthCacheMap | null = null;
let pendingLoad: Promise<GatewayAuthCacheMap> | null = null;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function parseCache(raw: string | null | undefined): GatewayAuthCacheMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const entries = Object.entries(parsed);
    const next: GatewayAuthCacheMap = {};
    for (const [key, value] of entries) {
      if (!value || typeof value !== "object") continue;
      const candidate = value as Record<string, unknown>;
      if (
        typeof candidate.deviceToken !== "string"
        || typeof candidate.role !== "string"
        || !Array.isArray(candidate.scopes)
        || typeof candidate.authTokenSha256 !== "string"
        || typeof candidate.updatedAtMs !== "number"
      ) {
        continue;
      }
      next[key] = {
        deviceToken: candidate.deviceToken,
        role: candidate.role,
        scopes: candidate.scopes.filter((item): item is string => typeof item === "string"),
        issuedAtMs: typeof candidate.issuedAtMs === "number" ? candidate.issuedAtMs : undefined,
        deviceTokens: Array.isArray(candidate.deviceTokens)
          ? candidate.deviceTokens
            .filter((item): item is GatewayAuthToken => {
              if (!item || typeof item !== "object") return false;
              const token = item as Record<string, unknown>;
              return typeof token.deviceToken === "string"
                && typeof token.role === "string"
                && Array.isArray(token.scopes);
            })
            .map((item) => ({
              deviceToken: item.deviceToken,
              role: item.role,
              scopes: item.scopes.filter((scope): scope is string => typeof scope === "string"),
              issuedAtMs: typeof item.issuedAtMs === "number" ? item.issuedAtMs : undefined,
            }))
          : undefined,
        authTokenSha256: candidate.authTokenSha256,
        updatedAtMs: candidate.updatedAtMs,
      };
    }
    return next;
  } catch {
    return {};
  }
}

function stringifyCache(cache: GatewayAuthCacheMap): string {
  return JSON.stringify(cache);
}

async function loadCacheMap(): Promise<GatewayAuthCacheMap> {
  if (cachedMap) return cachedMap;
  if (pendingLoad) return pendingLoad;

  pendingLoad = (async () => {
    if (!isBrowser()) return {};

    if (isNativeMode()) {
      try {
        const raw = await requestNativeGatewayAuthGet();
        cachedMap = parseCache(raw);
        return cachedMap;
      } catch {
        cachedMap = {};
        return cachedMap;
      } finally {
        pendingLoad = null;
      }
    }

    const raw = window.localStorage.getItem(GATEWAY_AUTH_STORAGE_KEY);
    cachedMap = parseCache(raw);
    pendingLoad = null;
    return cachedMap;
  })();

  return pendingLoad;
}

async function persistCacheMap(cache: GatewayAuthCacheMap): Promise<void> {
  cachedMap = cache;
  if (!isBrowser()) return;

  if (isNativeMode()) {
    try {
      if (Object.keys(cache).length === 0) postNativeGatewayAuthDelete();
      else postNativeGatewayAuthSet(stringifyCache(cache));
    } catch {
      // Native storage failures should not block connects.
    }
    return;
  }

  if (Object.keys(cache).length === 0) {
    window.localStorage.removeItem(GATEWAY_AUTH_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(GATEWAY_AUTH_STORAGE_KEY, stringifyCache(cache));
}

export function normalizeGatewayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    if (parsed.pathname === "/") parsed.pathname = "";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

export function isLoopbackGatewayUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export function shouldPersistGatewayAuthHandoffTokens(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "wss:" || (parsed.protocol === "ws:" && isLoopbackGatewayUrl(url));
  } catch {
    return false;
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashAuthToken(token: string | null | undefined): Promise<string> {
  return sha256Hex(token ?? "");
}

export function buildGatewayAuthCacheEntry(
  url: string,
  auth: HelloOkAuth,
  authTokenSha256: string,
): GatewayAuthCacheEntry {
  return {
    deviceToken: auth.deviceToken,
    role: auth.role,
    scopes: [...auth.scopes],
    issuedAtMs: auth.issuedAtMs,
    deviceTokens: shouldPersistGatewayAuthHandoffTokens(url) ? auth.deviceTokens?.map((item) => ({
      deviceToken: item.deviceToken,
      role: item.role,
      scopes: [...item.scopes],
      issuedAtMs: item.issuedAtMs,
    })) : undefined,
    authTokenSha256,
    updatedAtMs: Date.now(),
  };
}

export async function getGatewayAuthCacheEntry(url: string): Promise<GatewayAuthCacheEntry | null> {
  const cache = await loadCacheMap();
  return cache[normalizeGatewayUrl(url)] ?? null;
}

export async function setGatewayAuthCacheEntry(url: string, entry: GatewayAuthCacheEntry): Promise<void> {
  const cache = await loadCacheMap();
  cache[normalizeGatewayUrl(url)] = entry;
  await persistCacheMap(cache);
}

export async function deleteGatewayAuthCacheEntry(url: string): Promise<void> {
  const cache = await loadCacheMap();
  delete cache[normalizeGatewayUrl(url)];
  await persistCacheMap(cache);
}

export async function persistHelloOkAuth(
  url: string,
  auth: HelloOkAuth | undefined,
  authTokenSha256: string,
): Promise<GatewayAuthCacheEntry | null> {
  if (!auth?.deviceToken) return null;
  const entry = buildGatewayAuthCacheEntry(url, auth, authTokenSha256);
  await setGatewayAuthCacheEntry(url, entry);
  return entry;
}

export function resetGatewayAuthCacheForTests(): void {
  cachedMap = null;
  pendingLoad = null;
}
