"use client";

import { useState, useEffect, useRef } from "react";
import type { UnfurlData } from "@/lib/unfurl";
import { extractUrls, shouldUnfurl, fetchUnfurl, isUnfurlDisabled } from "@/lib/unfurl";

const MAX_UNFURLS = 3;
const DEBOUNCE_MS = 300;
const MAX_CONCURRENT = 2;

export function useUnfurl(text: string, isStreaming: boolean): UnfurlData[] {
  const [unfurls, setUnfurls] = useState<UnfurlData[]>([]);
  const prevTextRef = useRef<string>("");
  const fetchedRef = useRef(false);

  useEffect(() => {
    // Don't fetch while streaming
    if (isStreaming) return;

    // Don't re-fetch if text hasn't changed
    if (text === prevTextRef.current && fetchedRef.current) return;

    // Don't fetch if disabled
    if (isUnfurlDisabled()) return;

    prevTextRef.current = text;
    fetchedRef.current = true;

    const urls = extractUrls(text).filter(shouldUnfurl).slice(0, MAX_UNFURLS);
    if (urls.length === 0) return;

    let cancelled = false;

    const fetchAll = async () => {
      const results: UnfurlData[] = [];
      // Process in batches of MAX_CONCURRENT
      for (let i = 0; i < urls.length; i += MAX_CONCURRENT) {
        if (cancelled) break;
        const batch = urls.slice(i, i + MAX_CONCURRENT);
        const batchResults = await Promise.all(batch.map(fetchUnfurl));
        for (const r of batchResults) {
          if (r && !cancelled) results.push(r);
        }
      }
      if (!cancelled && results.length > 0) {
        setUnfurls(results);
      }
    };

    const timer = setTimeout(fetchAll, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, isStreaming]);

  return unfurls;
}
