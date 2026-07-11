/**
 * Maps MCP tool results to plugin content parts.
 * When a tool result arrives for a tool that a registered app plugin knows how
 * to render, this module generates the corresponding plugin part so the plugin
 * components render inline — even though no emitPlugin() side-effect fired.
 * The tool-name → builder mapping is product-specific and lives in
 * plugins/app/toolResultBuilders.ts; this file is only the mechanism.
 */

import { appToolResultBuilders } from "@mc/plugins/app";
import type { ContentPart, Message, PluginContentPart } from "@mc/types/chat";

type PluginMatch = PluginContentPart | null;

/**
 * Scan history messages for tool_call parts with results that map to plugins.
 * Injects plugin content parts after matching tool calls. Idempotent — skips
 * messages that already have plugin parts with the same partId.
 */
export function injectPluginsFromHistory(messages: Message[]): Message[] {
  let changed = false;
  const result = messages.map((msg) => {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) return msg;

    const newParts: ContentPart[] = [];
    let msgChanged = false;

    for (const part of msg.content) {
      newParts.push(part);

      if ((part.type === "tool_call" || part.type === "toolCall") && part.name && part.result && part.status === "success") {
        const plugin = pluginFromToolResult(part.name, part.result, !!part.resultError);
        if (plugin) {
          // Skip if already injected
          const alreadyExists = msg.content.some(
            (p) => p.type === "plugin" && p.partId === plugin.partId,
          );
          if (!alreadyExists) {
            newParts.push(plugin);
            msgChanged = true;
          }
        }
      }
    }

    if (msgChanged) {
      changed = true;
      return { ...msg, content: newParts };
    }
    return msg;
  });

  return changed ? result : messages;
}

/** Strip MCP server prefix (e.g. "octoclaw__list_flows" → "list_flows") */
function stripMcpPrefix(name: string): string {
  const idx = name.lastIndexOf("__");
  return idx >= 0 ? name.slice(idx + 2) : name;
}

/** Try to derive a plugin part from a tool result. Returns null if no match. */
export function pluginFromToolResult(
  toolName: string,
  resultText: string,
  isError: boolean,
): PluginMatch {
  if (isError) return null;

  const build = appToolResultBuilders[stripMcpPrefix(toolName)];
  if (!build) return null;

  let data: unknown;
  try {
    data = JSON.parse(resultText);
  } catch {
    return null;
  }

  return build(data);
}
