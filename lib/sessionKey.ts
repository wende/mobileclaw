/** localStorage key for the stable OpenClaw session identifier. */
export const SESSION_KEY_STORAGE = "wendebot-session-key";

const SESSION_KEY_PARAM = "sessionKey";

/** Hex (16–64 chars) or UUID-shaped keys from embed/parent pages. */
const SESSION_KEY_PATTERN = /^(?:[a-f0-9]{16,64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function isValidSessionKey(key: string): boolean {
  return SESSION_KEY_PATTERN.test(key);
}

/** Normalize to the 16-char hex format the proxy expects. */
export function normalizeSessionKey(key: string): string {
  if (/^[a-f0-9]{16,64}$/i.test(key)) return key.slice(0, 32);
  return key.replace(/-/g, "").slice(0, 32);
}

function readUrlSessionKey(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get(SESSION_KEY_PARAM);
  return fromUrl && isValidSessionKey(fromUrl) ? fromUrl : null;
}

/** Return a stable session key, preferring URL param then localStorage, else creating one. */
export function getOrCreateSessionKey(): string {
  if (typeof window === "undefined") return "";

  const fromUrl = readUrlSessionKey();
  if (fromUrl) {
    const normalized = normalizeSessionKey(fromUrl);
    try {
      localStorage.setItem(SESSION_KEY_STORAGE, normalized);
    } catch {}
    return normalized;
  }

  try {
    const stored = localStorage.getItem(SESSION_KEY_STORAGE);
    if (stored && isValidSessionKey(stored)) return normalizeSessionKey(stored);
  } catch {}

  const created = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  try {
    localStorage.setItem(SESSION_KEY_STORAGE, created);
  } catch {}
  return created;
}

/** Append sessionKey query param so the proxy assigns stable server-side history. */
export function appendSessionKeyToWsUrl(url: string, sessionKey: string): string {
  const isSecure = url.startsWith("wss://") || url.startsWith("https://");
  const httpBase = url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
  const parsed = new URL(httpBase);
  parsed.searchParams.set(SESSION_KEY_PARAM, sessionKey);
  const out = parsed.toString();
  return isSecure ? out.replace(/^https:\/\//, "wss://") : out.replace(/^http:\/\//, "ws://");
}

export function clearStoredSessionKey(): void {
  try {
    localStorage.removeItem(SESSION_KEY_STORAGE);
  } catch {}
}
