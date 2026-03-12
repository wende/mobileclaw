import { builtinPlugins } from "@/lib/plugins/builtins";
import { appPlugins } from "@/plugins/app";
import type { AnyMobileClawPlugin, PluginWidth } from "@/lib/plugins/types";

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
