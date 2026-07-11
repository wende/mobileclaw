const BOTTOM_PAD_SVH = 4.5;
const BOTTOM_PAD_BASE_REM = 12.5;
const BOTTOM_PAD_QUEUED_REM = 15.5;
const BOTTOM_PAD_PINNED_REM = 18.5;
const BOTTOM_PAD_DETACHED_BASE = "9rem";
const BOTTOM_PAD_DETACHED_QUEUED = "12rem";
const BOTTOM_PAD_DETACHED_PINNED = "15rem";
const BOTTOM_PAD_NATIVE = "8rem";
const BOTTOM_PAD_DOCUMENT_SCROLL = "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)";
const FOOTER_RESERVE_DOCUMENT_SCROLL_BASE = "calc(env(safe-area-inset-bottom, 0px) + 4rem)";
const FOOTER_RESERVE_DOCUMENT_SCROLL_QUEUED = "calc(env(safe-area-inset-bottom, 0px) + 7rem)";
const FOOTER_RESERVE_DOCUMENT_SCROLL_PINNED = "calc(env(safe-area-inset-bottom, 0px) + 10rem)";
const THINKING_INDICATOR_GAP = "1.5rem";

export const DEFAULT_INPUT_ZONE_HEIGHT = "calc(1.5dvh + 3.5rem)";

function addCalc(...parts: string[]): string {
  return `calc(${parts.join(" + ")})`;
}

export function getChatBottomPad({
  isNative,
  isDetached,
  useDocumentScroll = false,
  inputZoneHeight = DEFAULT_INPUT_ZONE_HEIGHT,
  hasQueued,
  hasPinnedSubagent,
}: {
  isNative: boolean;
  isDetached: boolean;
  useDocumentScroll?: boolean;
  inputZoneHeight?: string;
  hasQueued: boolean;
  hasPinnedSubagent: boolean;
}): string {
  if (isNative) return BOTTOM_PAD_NATIVE;
  if (useDocumentScroll) return BOTTOM_PAD_DOCUMENT_SCROLL;

  if (isDetached) {
    const overlayPad = hasPinnedSubagent
      ? BOTTOM_PAD_DETACHED_PINNED
      : hasQueued
        ? BOTTOM_PAD_DETACHED_QUEUED
        : BOTTOM_PAD_DETACHED_BASE;

    // Detached mode renders a spacer below the scroll area for the fixed composer.
    // Reserve that composer height again inside the scroll content so floating
    // overlays like the thinking indicator sit above the bar instead of inside it.
    return addCalc(inputZoneHeight, overlayPad);
  }

  if (hasPinnedSubagent) return `calc(${BOTTOM_PAD_SVH}svh + ${BOTTOM_PAD_PINNED_REM}rem)`;
  if (hasQueued) return `calc(${BOTTOM_PAD_SVH}svh + ${BOTTOM_PAD_QUEUED_REM}rem)`;
  return `calc(${BOTTOM_PAD_SVH}svh + ${BOTTOM_PAD_BASE_REM}rem)`;
}

export function getThinkingIndicatorBottom({
  isDetached,
  useDocumentScroll = false,
  inputZoneHeight = DEFAULT_INPUT_ZONE_HEIGHT,
}: {
  isDetached: boolean;
  useDocumentScroll?: boolean;
  inputZoneHeight?: string;
}): string {
  if (useDocumentScroll) {
    return addCalc(BOTTOM_PAD_DOCUMENT_SCROLL, THINKING_INDICATOR_GAP);
  }
  return isDetached
    ? addCalc(inputZoneHeight, inputZoneHeight, THINKING_INDICATOR_GAP)
    : addCalc(inputZoneHeight, THINKING_INDICATOR_GAP);
}

export function getDocumentScrollFooterReserve({
  hasQueued,
  hasPinnedSubagent,
}: {
  hasQueued: boolean;
  hasPinnedSubagent: boolean;
}): string {
  if (hasPinnedSubagent) return FOOTER_RESERVE_DOCUMENT_SCROLL_PINNED;
  if (hasQueued) return FOOTER_RESERVE_DOCUMENT_SCROLL_QUEUED;
  return FOOTER_RESERVE_DOCUMENT_SCROLL_BASE;
}
