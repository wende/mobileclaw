import { builtinPlugins } from "@mc/lib/plugins/builtins";
import { appPlugins } from "@mc/plugins/app";
import type { AnyMobileClawPlugin, PluginWidth } from "@mc/lib/plugins/types";

const registry = new Map<string, AnyMobileClawPlugin>();

for (const plugin of [...builtinPlugins, ...appPlugins]) {
  registry.set(plugin.type, plugin);
}

export const pluginRegistry = {
  get(type: string): AnyMobileClawPlugin | undefined {
    return registry.get(type);
  },
  getWidth(type: string): PluginWidth {
    return registry.get(type)?.width || "bubble";
  },
  list(): AnyMobileClawPlugin[] {
    return [...registry.values()];
  },
};
