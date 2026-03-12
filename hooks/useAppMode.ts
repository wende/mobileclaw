import { useState, useRef, useEffect } from "react";
import { useWidgetContext } from "@/lib/widgetContext";

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

const SSR_SAFE_MODE: InitialAppMode = {
  isDetached: false,
  detachedNoBorder: false,
  isNative: false,
  uploadDisabled: false,
};

function getUrlAppMode(): InitialAppMode {
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
  const widgetCtx = useWidgetContext();

  // When embedded via WidgetContextProvider, use context values as initial state
  // so the first render (including SSR) is already correct — no flash, no hydration mismatch.
  const [mode, setMode] = useState<InitialAppMode>(() => {
    if (widgetCtx) {
      return {
        isDetached: widgetCtx.isDetached,
        detachedNoBorder: widgetCtx.noBorder,
        isNative: false,
        uploadDisabled: false,
      };
    }
    return SSR_SAFE_MODE;
  });

  const isDetachedRef = useRef(widgetCtx?.isDetached ?? false);
  const isNativeRef = useRef(false);

  useEffect(() => {
    const resolvedMode = widgetCtx
      ? {
          isDetached: widgetCtx.isDetached,
          detachedNoBorder: widgetCtx.noBorder,
          isNative: false,
          uploadDisabled: false,
        }
      : getUrlAppMode();

    setMode(resolvedMode);
    isDetachedRef.current = resolvedMode.isDetached;
    isNativeRef.current = resolvedMode.isNative;

    if (resolvedMode.isDetached) {
      document.body.style.background = "transparent";
      document.documentElement.style.background = "transparent";
    }

    if (resolvedMode.isNative) {
      document.body.classList.add("native");
      document.body.style.background = "transparent";
      document.documentElement.style.background = "transparent";
    }

    document.documentElement.classList.remove("native-loading");
    document.documentElement.classList.remove("detached-loading");
  }, [widgetCtx]);

  const hideChrome = mode.isDetached || mode.isNative;

  return {
    isDetached: mode.isDetached,
    detachedNoBorder: mode.detachedNoBorder,
    isNative: mode.isNative,
    uploadDisabled: mode.uploadDisabled,
    hideChrome,
    isDetachedRef,
    isNativeRef,
  };
}
