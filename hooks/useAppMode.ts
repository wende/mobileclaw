import { useState, useRef, useEffect } from "react";

/** Read a URL search param. Returns null when absent or during SSR. */
function getSearchParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

export interface AppMode {
  isDetached: boolean;
  isNative: boolean;
  uploadDisabled: boolean;
  hideChrome: boolean;
  isDetachedRef: React.MutableRefObject<boolean>;
  isNativeRef: React.MutableRefObject<boolean>;
}

export function useAppMode(): AppMode {
  const [isDetached, setIsDetached] = useState(false);
  const isDetachedRef = useRef(false);
  const [isNative, setIsNative] = useState(false);
  const isNativeRef = useRef(false);
  const [uploadDisabled, setUploadDisabled] = useState(false);

  const hasDetectedRef = useRef(false);

  // Synchronous ref assignment during render so refs are available
  // before other hooks' effects run.
  if (!hasDetectedRef.current && typeof window !== "undefined") {
    hasDetectedRef.current = true;

    if (getSearchParam("detached") !== null) {
      isDetachedRef.current = true;
    }

    const nativeFlag = (window as unknown as { __nativeMode?: boolean }).__nativeMode === true;
    if (getSearchParam("native") !== null || nativeFlag) {
      isNativeRef.current = true;
    }
  }

  // State + DOM side effects in a single effect (runs once).
  useEffect(() => {
    if (isDetachedRef.current) {
      setIsDetached(true);
      document.body.style.background = "transparent";
      document.documentElement.style.background = "transparent";
    }

    if (isNativeRef.current) {
      setIsNative(true);
      document.body.classList.add("native");
      document.body.style.background = "transparent";
      document.documentElement.style.background = "transparent";
      document.documentElement.classList.remove("native-loading");
    }

    if (getSearchParam("upload") === "false") {
      setUploadDisabled(true);
    }
  }, []);

  const hideChrome = isDetached || isNative;

  return { isDetached, isNative, uploadDisabled, hideChrome, isDetachedRef, isNativeRef };
}
