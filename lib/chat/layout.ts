const BOTTOM_PAD_SVH = 4.5;
const BOTTOM_PAD_SVH_STANDALONE = 7;
const BOTTOM_PAD_BASE_REM = 7.5;
const BOTTOM_PAD_QUEUED_REM = 10.5;
const BOTTOM_PAD_PINNED_REM = 13.5;
const BOTTOM_PAD_DETACHED_BASE = "4rem";
const BOTTOM_PAD_DETACHED_QUEUED = "7rem";
const BOTTOM_PAD_DETACHED_PINNED = "10rem";
const BOTTOM_PAD_NATIVE = "8rem";
const THINKING_INDICATOR_GAP = "1.5rem";

export const DEFAULT_INPUT_ZONE_HEIGHT = "calc(1.5dvh + 3.5rem)";

function addCalc(...parts: string[]): string {
  return `calc(${parts.join(" + ")})`;
}

export function getChatBottomPad({
  isNative,
  isDetached,
  isStandalone = false,
  inputZoneHeight = DEFAULT_INPUT_ZONE_HEIGHT,
  hasQueued,
  hasPinnedSubagent,
}: {
  isNative: boolean;
  isDetached: boolean;
  isStandalone?: boolean;
  inputZoneHeight?: string;
  hasQueued: boolean;
  hasPinnedSubagent: boolean;
}): string {
  if (isNative) return BOTTOM_PAD_NATIVE;

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

  const svh = isStandalone ? BOTTOM_PAD_SVH_STANDALONE : BOTTOM_PAD_SVH;
  if (hasPinnedSubagent) return `calc(${svh}svh + ${BOTTOM_PAD_PINNED_REM}rem)`;
  if (hasQueued) return `calc(${svh}svh + ${BOTTOM_PAD_QUEUED_REM}rem)`;
  return `calc(${svh}svh + ${BOTTOM_PAD_BASE_REM}rem)`;
}

export function getThinkingIndicatorBottom({
  isDetached,
  inputZoneHeight = DEFAULT_INPUT_ZONE_HEIGHT,
}: {
  isDetached: boolean;
  inputZoneHeight?: string;
}): string {
  return isDetached
    ? addCalc(inputZoneHeight, inputZoneHeight, THINKING_INDICATOR_GAP)
    : addCalc(inputZoneHeight, THINKING_INDICATOR_GAP);
}
