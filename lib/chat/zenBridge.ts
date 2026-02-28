interface ApplyNativeZenModeOptions {
  enabled: boolean;
  current: boolean;
  toggle: () => void;
}

export function applyNativeZenMode({ enabled, current, toggle }: ApplyNativeZenModeOptions): boolean {
  if (enabled === current) return false;
  toggle();
  return true;
}
