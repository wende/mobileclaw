// Bottom-pad reserves are capped relative to the viewport so they never
// dominate short or narrow layouts (embeds, landscape phones, small windows).
// Each pad reaches its full rem value at the 800px-tall / 400px-wide reference
// viewport and shrinks proportionally with the smaller dimension below that.
function viewportCappedRem(rem: number): string {
  return `min(${rem}rem, ${rem * 2}svh, ${rem * 4}svw)`;
}

const BOTTOM_PAD_SVH = 4.5;
const BOTTOM_PAD_BASE = viewportCappedRem(12.5);
const BOTTOM_PAD_QUEUED = viewportCappedRem(15.5);
const BOTTOM_PAD_PINNED = viewportCappedRem(18.5);
const BOTTOM_PAD_DETACHED_QUEUED = viewportCappedRem(12);
const BOTTOM_PAD_DETACHED_PINNED = viewportCappedRem(15);
const BOTTOM_PAD_NATIVE = viewportCappedRem(8);
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
    // The viewport already has a detached composer spacer below the scroll area.
    // Only add message-list padding when a queued or pinned panel extends above it.
    if (!hasPinnedSubagent && !hasQueued) return "1rem";

    return hasPinnedSubagent
      ? BOTTOM_PAD_DETACHED_PINNED
      : hasQueued
        ? BOTTOM_PAD_DETACHED_QUEUED
        : "0px";
  }

  if (hasPinnedSubagent) return `calc(${BOTTOM_PAD_SVH}svh + ${BOTTOM_PAD_PINNED})`;
  if (hasQueued) return `calc(${BOTTOM_PAD_SVH}svh + ${BOTTOM_PAD_QUEUED})`;
  return `calc(${BOTTOM_PAD_SVH}svh + ${BOTTOM_PAD_BASE})`;
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
