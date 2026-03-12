import type { PluginActionInvocation } from "@/lib/plugins/types";

export interface PluginActionHostPayload {
  messageId: string;
  partId: string;
  pluginType: string;
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
