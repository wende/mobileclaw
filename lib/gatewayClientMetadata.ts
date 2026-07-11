export const DEFAULT_GATEWAY_CLIENT_ID = "openclaw-control-ui";
export const DEFAULT_GATEWAY_CLIENT_MODE = "webchat";
export const DEFAULT_GATEWAY_SCOPES = [
  "operator.read",
  "operator.write",
  "operator.admin",
  "operator.approvals",
  "operator.pairing",
] as const;

export type GatewayClientMetadata = {
  platform: string;
  deviceFamily: string;
  locale?: string;
  userAgent?: string;
};

function normalizeTrimmedMetadata(value?: string | null): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed ? trimmed : "";
}

export function normalizeDeviceMetadataForAuth(value?: string | null): string {
  const trimmed = normalizeTrimmedMetadata(value);
  if (!trimmed) return "";
  return trimmed.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
}

function inferDeviceFamily(userAgent: string): string {
  const normalized = normalizeDeviceMetadataForAuth(userAgent);
  if (!normalized) return "desktop";
  if (normalized.includes("ipad") || normalized.includes("tablet")) return "tablet";
  if (
    normalized.includes("iphone")
    || normalized.includes("android")
    || normalized.includes("mobile")
    || normalized.includes("ipod")
  ) {
    return "mobile";
  }
  return "desktop";
}

export function getGatewayClientMetadata(opts: { isNative: boolean }): GatewayClientMetadata {
  if (typeof navigator === "undefined") {
    return {
      platform: opts.isNative ? "ios" : "web",
      deviceFamily: opts.isNative ? "mobile" : "desktop",
    };
  }

  const userAgent = navigator.userAgent || undefined;
  const rawPlatform = opts.isNative ? "ios" : (navigator.platform || "web");
  const platform = normalizeDeviceMetadataForAuth(rawPlatform) || (opts.isNative ? "ios" : "web");
  const deviceFamily = opts.isNative
    ? inferDeviceFamily(userAgent || "iphone")
    : inferDeviceFamily(userAgent || "");
  const locale = normalizeTrimmedMetadata(navigator.language);

  return {
    platform,
    deviceFamily,
    locale: locale || undefined,
    userAgent,
  };
}
