import type { PluginActionInvocation } from "@/lib/plugins/types";

export interface PluginActionHostPayload {
  messageId: string;
  partId: string;
  pluginType: string;
}

const ABSOLUTE_URL_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

function serializeQueryValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function getPluginActionHostPayload(
  invocation: Pick<PluginActionInvocation, "messageId" | "part">,
): PluginActionHostPayload {
  return {
    messageId: invocation.messageId,
    partId: invocation.part.partId,
    pluginType: invocation.part.pluginType,
  };
}

export function mergePluginActionPayload(
  base: Record<string, unknown> | undefined,
  invocation: Pick<PluginActionInvocation, "messageId" | "part" | "input">,
): Record<string, unknown> {
  return {
    ...(base || {}),
    ...(invocation.input || {}),
    ...getPluginActionHostPayload(invocation),
  };
}

export function appendPluginActionPayloadToUrl(
  url: string,
  payload: Record<string, unknown>,
  baseOrigin = "https://mobileclaw.local",
): string {
  const resolved = new URL(url, baseOrigin);

  for (const [key, value] of Object.entries(payload)) {
    const serialized = serializeQueryValue(value);
    if (serialized == null) continue;
    resolved.searchParams.set(key, serialized);
  }

  if (ABSOLUTE_URL_RE.test(url)) {
    return resolved.toString();
  }

  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
