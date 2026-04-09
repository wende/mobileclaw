export type DetachedSurface = "url" | "widget";

export type ChatLayoutMode = "document-scroll" | "viewport-shell" | "parent-shell";

interface ChatLayoutConfigOptions {
  isDetached: boolean;
  detachedNoShell: boolean;
  isNative: boolean;
  isMobileViewport: boolean;
  detachedSurface: DetachedSurface;
}

interface ChatLayoutConfig {
  mode: ChatLayoutMode;
  useDocumentScroll: boolean;
  shellHeight: "100dvh" | "100%" | null;
  useKeyboardLayout: boolean;
}

export function getChatLayoutConfig({
  isDetached,
  detachedNoShell,
  isNative,
  isMobileViewport,
  detachedSurface,
}: ChatLayoutConfigOptions): ChatLayoutConfig {
  let mode: ChatLayoutMode;

  if (!isDetached || isNative) {
    mode = "viewport-shell";
  } else if (isMobileViewport && (detachedSurface === "widget" || detachedNoShell)) {
    mode = "document-scroll";
  } else {
    mode = detachedSurface === "widget" ? "parent-shell" : "viewport-shell";
  }

  return {
    mode,
    useDocumentScroll: mode === "document-scroll",
    shellHeight: mode === "document-scroll" ? null : mode === "parent-shell" ? "100%" : "100dvh",
    useKeyboardLayout: !isNative && isMobileViewport && mode !== "document-scroll",
  };
}
