"use client";

import { InvalidPluginCard } from "@/components/plugins/InvalidPluginCard";
import { UnknownPluginCard } from "@/components/plugins/UnknownPluginCard";
import { pluginRegistry } from "@/lib/plugins/registry";
import type { PluginActionHandler, PluginParseResult } from "@/lib/plugins/types";
import type { PluginContentPart } from "@/types/chat";

export function PluginRenderer({
  part,
  messageId,
  isStreaming,
  onAction,
  onAddInputAttachment,
}: {
  part: PluginContentPart;
  messageId: string;
  isStreaming: boolean;
  onAction?: PluginActionHandler;
  onAddInputAttachment?: (kind: string, data: unknown) => void;
}) {
  const pluginType = part.pluginType || "unknown";
  const plugin = pluginRegistry.get(pluginType);
  if (!plugin) {
    return <UnknownPluginCard pluginType={pluginType} />;
  }

  const parsed = plugin.parse(part.data) as PluginParseResult<unknown>;
  if (!parsed.ok) {
    return <InvalidPluginCard pluginType={pluginType} />;
  }

  return (
    <>
      {plugin.render({
        messageId,
        part,
        partId: part.partId,
        state: part.state,
        data: parsed.value,
        isStreaming,
        invokeAction: async (action, input) => {
          if (!onAction) {
            throw new Error("Plugin actions are unavailable.");
          }
          await onAction({ messageId, part, action, input });
        },
        addInputAttachment: onAddInputAttachment,
      })}
    </>
  );
}
