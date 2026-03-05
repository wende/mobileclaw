import { useState, useRef, useEffect } from "react";

/** Read a URL search param. Returns null when absent or during SSR. */
function getSearchParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

interface InitialAppMode {
  isDetached: boolean;
  detachedNoBorder: boolean;
  isNative: boolean;
  uploadDisabled: boolean;
}

function getInitialAppMode(): InitialAppMode {
  const isDetached = getSearchParam("detached") !== null;
  const detachedNoBorder = isDetached && getSearchParam("noborder") !== null;
  const nativeFlag = typeof window !== "undefined"
    && (window as unknown as { __nativeMode?: boolean }).__nativeMode === true;
  const isNative = getSearchParam("native") !== null || nativeFlag;
  const uploadDisabled = getSearchParam("upload") === "false";
  return { isDetached, detachedNoBorder, isNative, uploadDisabled };
}

export interface AppMode {
  isDetached: boolean;
  detachedNoBorder: boolean;
  isNative: boolean;
  uploadDisabled: boolean;
  hideChrome: boolean;
  isDetachedRef: React.MutableRefObject<boolean>;
  isNativeRef: React.MutableRefObject<boolean>;
}

export function useAppMode(): AppMode {
  const initialRef = useRef<InitialAppMode>(getInitialAppMode());
  const [isDetached] = useState(initialRef.current.isDetached);
  const [detachedNoBorder] = useState(initialRef.current.detachedNoBorder);
  const isDetachedRef = useRef(initialRef.current.isDetached);
  const [isNative] = useState(initialRef.current.isNative);
  const isNativeRef = useRef(initialRef.current.isNative);
  const [uploadDisabled] = useState(initialRef.current.uploadDisabled);

  // State + DOM side effects in a single effect (runs once).
  useEffect(() => {
    if (isDetached) {
      document.body.style.background = "transparent";
      document.documentElement.style.background = "transparent";
    }

    if (isNative) {
      document.body.classList.add("native");
      document.body.style.background = "transparent";
      document.documentElement.style.background = "transparent";
      document.documentElement.classList.remove("native-loading");
    }

    document.documentElement.classList.remove("detached-loading");
  }, [isDetached, isNative]);

  const hideChrome = isDetached || isNative;

  return { isDetached, detachedNoBorder, isNative, uploadDisabled, hideChrome, isDetachedRef, isNativeRef };
}
