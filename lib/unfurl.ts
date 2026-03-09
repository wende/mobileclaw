// URL unfurling: types, extraction, filtering, cache

export interface UnfurlData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
  domain: string;
}

// Bare URL regex — matches http/https URLs in plain text
export const BARE_URL_REGEX = /https?:\/\/[^\s<>]*[^\s<>.,;:!?'"\])>]/g;

// File extensions that shouldn't be unfurled
const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|py|rb|go|rs|java|c|cpp|h|hpp|cs|swift|kt|scala|clj|ex|exs|erl|hs|ml|sh|bash|zsh|fish|ps1|bat|cmd|yml|yaml|toml|ini|cfg|conf|json|xml|html|css|scss|less|sass|sql|graphql|proto|md|txt|log|csv|tsv)$/i;
const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp|tiff|avif)$/i;

export function extractUrls(text: string): string[] {
  const matches = text.match(BARE_URL_REGEX);
  if (!matches) return [];
  // Deduplicate
  return [...new Set(matches)];
}

export function shouldUnfurl(url: string): boolean {
  if (url.length > 500) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "0.0.0.0") return false;
    if (parsed.pathname.startsWith("/api/")) return false;
    if (CODE_EXTENSIONS.test(parsed.pathname)) return false;
    if (IMAGE_EXTENSIONS.test(parsed.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

// In-memory cache: null means tried & failed
const unfurlCache = new Map<string, UnfurlData | null>();
const MAX_CACHE = 200;

const STORAGE_KEY = "mobileclaw:unfurl-cache";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface StoredEntry {
  data: UnfurlData;
  ts: number;
}

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const entries: StoredEntry[] = JSON.parse(raw);
    const now = Date.now();
    for (const entry of entries) {
      if (now - entry.ts < TTL_MS) {
        unfurlCache.set(entry.data.url, entry.data);
      }
    }
  } catch {
    // ignore
  }
}

function saveToStorage(): void {
  try {
    const entries: StoredEntry[] = [];
    const now = Date.now();
    for (const [, data] of unfurlCache) {
      if (data && entries.length < 100) {
        entries.push({ data, ts: now });
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore
  }
}

let storageLoaded = false;

function ensureStorageLoaded(): void {
  if (storageLoaded) return;
  storageLoaded = true;
  if (typeof localStorage !== "undefined") {
    loadFromStorage();
  }
}

function evictIfNeeded(): void {
  if (unfurlCache.size <= MAX_CACHE) return;
  // Remove oldest entries (first inserted)
  const toRemove = unfurlCache.size - MAX_CACHE;
  let removed = 0;
  for (const key of unfurlCache.keys()) {
    if (removed >= toRemove) break;
    unfurlCache.delete(key);
    removed++;
  }
}

// Module-level disable flag — set on first fetch failure (handles iOS static export)
let unfurlDisabled = false;

export function isUnfurlDisabled(): boolean {
  return unfurlDisabled;
}

export async function fetchUnfurl(url: string): Promise<UnfurlData | null> {
  if (unfurlDisabled) return null;

  ensureStorageLoaded();

  if (unfurlCache.has(url)) {
    return unfurlCache.get(url) ?? null;
  }

  try {
    const res = await fetch(`/api/unfurl?url=${encodeURIComponent(url)}`);
    if (!res.ok) {
      // If the endpoint doesn't exist (iOS static export), disable globally
      if (res.status === 404) {
        unfurlDisabled = true;
      }
      unfurlCache.set(url, null);
      evictIfNeeded();
      return null;
    }
    const data: UnfurlData = await res.json();
    unfurlCache.set(url, data);
    evictIfNeeded();
    if (typeof localStorage !== "undefined") saveToStorage();
    return data;
  } catch {
    // Network error — likely no API route available (iOS export)
    unfurlDisabled = true;
    unfurlCache.set(url, null);
    return null;
  }
}

// For testing
export function _resetForTests(): void {
  unfurlCache.clear();
  unfurlDisabled = false;
  storageLoaded = false;
}

export function _getCache(): Map<string, UnfurlData | null> {
  return unfurlCache;
}
