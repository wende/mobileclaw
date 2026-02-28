import { useState, useEffect, useCallback } from "react";

export const ZEN_STORAGE_KEY = "mobileclaw-zen";

function readZenQueryParam(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("zen");
}

function readStoredZenMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(ZEN_STORAGE_KEY);
    return stored === "1" || stored === "true";
  } catch {
    return false;
  }
}

export function useZenMode() {
  const [zenMode, setZenMode] = useState(false);

  useEffect(() => {
    const stored = readStoredZenMode();
    const forcedByQuery = readZenQueryParam();
    setZenMode(forcedByQuery || stored);
  }, []);

  const toggleZenMode = useCallback(() => {
    setZenMode((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(ZEN_STORAGE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  return { zenMode, toggleZenMode };
}
