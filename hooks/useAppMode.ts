import { useState, useRef, useEffect } from "react";
import { useWidgetContext } from "@mc/lib/widgetContext";
import type { DetachedSurface } from "@mc/lib/chat/layoutMode";

interface InitialAppMode {
  isDetached: boolean;
  detachedNoBorder: boolean;
  detachedNoShell: boolean;
  isNative: boolean;
  uploadDisabled: boolean;
}

const SSR_SAFE_MODE: InitialAppMode = {
  isDetached: false,
  detachedNoBorder: false,
  detachedNoShell: false,
  isNative: false,
  uploadDisabled: false,
};

export function resolveUrlAppMode(search: string, nativeFlag = false): InitialAppMode {
  const params = new URLSearchParams(search);
  const isDetached = params.get("detached") !== null;
  const detachedNoBorder = isDetached && params.get("noborder") !== null;
  const detachedNoShell = isDetached && params.get("noshell") !== null;
  const isNative = params.get("native") !== null || nativeFlag;
  const uploadDisabled = params.get("upload") === "false";
  return { isDetached, detachedNoBorder, detachedNoShell, isNative, uploadDisabled };
}

function getUrlAppMode(): InitialAppMode {
  const nativeFlag = (window as unknown as { __nativeMode?: boolean }).__nativeMode === true;
  return resolveUrlAppMode(window.location.search, nativeFlag);
}

export interface AppMode {
  isDetached: boolean;
  detachedNoBorder: boolean;
  detachedNoShell: boolean;
  detachedSurface: DetachedSurface;
  isNative: boolean;
  uploadDisabled: boolean;
  hideChrome: boolean;
  isDetachedRef: React.MutableRefObject<boolean>;
  isNativeRef: React.MutableRefObject<boolean>;
}

export function useAppMode(): AppMode {
  const widgetCtx = useWidgetContext();
  const detachedSurface: DetachedSurface = widgetCtx ? "widget" : "url";

  // When embedded via WidgetContextProvider, use context values as initial state
  // so the first render (including SSR) is already correct — no flash, no hydration mismatch.
  const [mode, setMode] = useState<InitialAppMode>(() => {
    if (widgetCtx) {
      return {
        isDetached: widgetCtx.isDetached,
        detachedNoBorder: widgetCtx.noBorder,
        detachedNoShell: false,
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
          detachedNoShell: false,
          isNative: false,
          uploadDisabled: false,
        }
      : getUrlAppMode();

    setMode(resolvedMode);
    isDetachedRef.current = resolvedMode.isDetached;
    isNativeRef.current = resolvedMode.isNative;

    const shouldUseTransparentHostBackground = widgetCtx ? widgetCtx.transparentHostBackground !== false : false;

    if (resolvedMode.isDetached && shouldUseTransparentHostBackground) {
      document.body.style.background = "transparent";
      document.documentElement.style.background = "transparent";
    } else if (resolvedMode.isDetached) {
      document.body.style.background = "";
      document.documentElement.style.background = "";
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
    detachedNoShell: mode.detachedNoShell,
    detachedSurface,
    isNative: mode.isNative,
    uploadDisabled: mode.uploadDisabled,
    hideChrome,
    isDetachedRef,
    isNativeRef,
  };
}
